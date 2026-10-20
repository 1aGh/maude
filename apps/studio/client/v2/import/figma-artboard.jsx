// client/v2/import/figma-artboard.jsx — S8.17: an imported frame's inspector rows (canvas 12 · ia-figma-arrived).
//
//   "Figma's exact picture. Its text and shapes can't be changed until it's made editable."
//   [Make editable]   Turns this one artboard into layers. Needs the Figma desktop app open on this file,
//                     in Dev Mode — a paid Dev or Full seat.
//
// Shown only for an artboard the canvas's meta records as a Figma render (`figma.frames[] route: 'render'`,
// written by the importer — to-render.ts). Make editable is `figma.make-editable`: POST /_api/figma/explode
// (DDR-219 — the LOCAL Dev Mode server, one codegen call, the frame's name cross-checked first), Can edit on the
// canvas, enforced by the server. Unavailable is the common answer and reads as what to do next; nothing changes.

import { useEffect, useState } from 'react';
import { canvasRel } from '../access/access-client.js';
import { artboardFacts } from '../inspector/kinds/artboard-model.js';
import { registerSlot } from '../inspector/slots.js';
import { getPaletteEnv } from '../search/search-env.js';
import { FIGMA_WORDS as W, makeEditableWords } from './figma-model.js';

/** Is `artboardId` a Figma picture on this canvas? (null while the meta is being read) */
export function isFigmaPicture(meta, artboardId) {
  const frames = meta?.figma?.frames;
  if (!Array.isArray(frames) || !artboardId) return false;
  return frames.some((f) => f && f.id === artboardId && f.route === 'render');
}

function useCanvasMeta(file) {
  const [meta, setMeta] = useState(null);
  useEffect(() => {
    if (!file) return;
    let live = true;
    fetch(`/_api/canvas-meta?file=${encodeURIComponent(file)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => live && setMeta(m))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [file]);
  return meta;
}

export function FigmaPictureRows({ el, ctx }) {
  const file = ctx?.canvasFile ?? null;
  const meta = useCanvasMeta(file);
  const id = artboardFacts(el).id;
  const [state, setState] = useState({ busy: false, note: null });
  if (!isFigmaPicture(meta, id)) return null;

  const makeEditable = async () => {
    const rel = canvasRel(file, getPaletteEnv().designRel || '.design');
    if (!rel) return;
    setState({ busy: true, note: null });
    try {
      const res = await fetch('/_api/figma/explode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canvas: rel, artboard: id }),
      });
      const json = await res.json().catch(() => ({}));
      setState({
        busy: false,
        note: res.ok && json.ok ? null : makeEditableWords(json?.reason),
      });
    } catch {
      setState({ busy: false, note: makeEditableWords('unavailable') });
    }
  };

  return (
    <div className="fi-insp" data-testid="figma-picture">
      <p className="fi-insp-callout">
        <strong>{W.exactTitle}</strong>
        {W.exactRest}
      </p>
      <button
        type="button"
        className="btn btn--sm fi-wide"
        disabled={state.busy || ctx?.editable === false}
        onClick={makeEditable}
        data-testid="figma-make-editable"
      >
        {W.makeEditable}
      </button>
      <p className="bi-fine">{W.makeEditableFine}</p>
      {state.note ? (
        <p className="bi-error" role="alert" data-testid="figma-make-editable-note">
          {state.note}
        </p>
      ) : null}
    </div>
  );
}

export const FIGMA_ARTBOARD_SLOTS = Object.freeze([
  [
    'size',
    {
      id: 'size.figma-picture',
      order: 30,
      kinds: ['artboard'],
      when: ({ selection }) =>
        ((Array.isArray(selection) ? selection[0] : selection)?.attrs?.['data-dc-kind'] ||
          'digital') === 'digital',
      Body: FigmaPictureRows,
    },
  ],
]);

let off = null;
/** Registered once, from the sheet's module (FigmaImportPanel → figma-sheet → here). */
export function registerFigmaArtboardSlots() {
  if (off) return off;
  const offs = FIGMA_ARTBOARD_SLOTS.map(([section, entry]) => registerSlot(section, entry));
  off = () => {
    for (const o of offs) o();
    off = null;
  };
  return off;
}
