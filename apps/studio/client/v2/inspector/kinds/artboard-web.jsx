// client/v2/inspector/kinds/artboard-web.jsx — S7.21: the Web page artboard's rows (08 ak-web-hug, ak-web-widths).
//
//   Width           Desktop · 1440 (a breakpoint; Custom when it is none)
//   Height          Fits content | Fixed, and "1573 now — grows as you add."
//   Other widths    Add a width — Tablet and Mobile beside Desktop, their layout reflowed (toast + Undo)
//
// Fill and Layout come from artboard.jsx (S2.8); the exact W × H, Clip content and Kind are under Advanced
// (`artboard-advanced-rows.jsx`). The copies are `artboard.duplicate-at-width` (S2.10) asked of the open canvas, which
// knows where the boards stand; the toast with Undo is settled by the bridge when that write comes back (add-width.js).

import { Copy } from 'lucide-react';
import { useRef, useState } from 'react';
import { registerSlot } from '../slots.js';
import { Row } from '../sections/row.jsx';
import { useDismiss } from '../token-chip.jsx';
import { expectAddedWidths } from './add-width.js';
import { ADD_PAIR, canAddPair, widthWord } from './artboard-kinds-model.js';
import { otherWidths } from './artboard-model.js';
import { HeightRows, SizeSelectRow, handlersOf, useArtboardWrites } from './artboard-rows.jsx';

/** Ask for copies of this board at `widths`: the canvas places them; the legacy single-width write is the fallback. */
export function addWidths({ f, id, ctx, widths }) {
  const h = handlersOf(ctx);
  if (!id || widths.length === 0) return;
  if (ctx?.onRunAction) {
    expectAddedWidths({
      artboardId: id,
      widths,
      sourceWord: widthWord(Math.round(f.w ?? 0)),
      undo: () => ctx.onShellAction?.('edit.undo'),
    });
    ctx.onRunAction({
      dgn: 'run-action',
      v: 1,
      id: 'artboard.duplicate-at-width',
      params: widths.length === 1 ? { artboard: id, width: widths[0] } : { artboard: id, widths },
    });
    return;
  }
  for (const w of widths) h.onDuplicateArtboard?.(id, w);
}

/**
 * V2-8.5 C2 (08 ak-web-widths) — "Add a width" is a small button with the duplicate glyph that opens a short menu of
 * the widths this board is not (the board's `btn--sm`), not a native select with a placeholder option.
 */
function AddWidthMenu({ options, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(open, () => setOpen(false), ref);
  return (
    <span className="insp-len" ref={ref}>
      <button
        type="button"
        className="btn btn--sm"
        data-testid="insp-ab-add-width"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Copy size={12} strokeWidth={1.75} aria-hidden="true" />
        Add a width
      </button>
      {open ? (
        <div
          className="insp-menu insp-menu--end"
          role="menu"
          aria-label="Add a width"
          data-testid="insp-ab-add-width-menu"
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitem"
              className="insp-menu-i"
              data-testid={`insp-ab-add-width-${o.value}`}
              onClick={() => {
                setOpen(false);
                onPick(o.value);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

export function AddWidthRow({ f, id, ctx }) {
  const h = handlersOf(ctx);
  if (!id || !(ctx?.onRunAction || h.onDuplicateArtboard)) return null;
  const pair = canAddPair(f);
  return (
    <Row k="Other widths" name="ab-add-width">
      <AddWidthMenu
        options={[
          ...(pair ? [{ value: ADD_PAIR.value, label: 'Tablet and Mobile' }] : []),
          ...otherWidths(f).map((p) => ({ value: String(p.w), label: `${p.label} · ${p.w}` })),
        ]}
        onPick={(v) =>
          addWidths({
            f,
            id,
            ctx,
            widths: v === ADD_PAIR.value ? [...ADD_PAIR.widths] : [Number(v)],
          })
        }
      />
    </Row>
  );
}

function WebRows({ el, ctx }) {
  const { f, resize, setHug } = useArtboardWrites(el, ctx);
  return (
    <>
      <SizeSelectRow k="Width" f={f} resize={resize} />
      <HeightRows f={f} setHug={setHug} />
    </>
  );
}

// 08 ak-web-hug: the card reads Width · Height · Layout · Fill · Other widths, so the last row is seated after Fill
function WebWidthsRow({ el, ctx }) {
  const { f, id } = useArtboardWrites(el, ctx);
  return <AddWidthRow f={f} id={id} ctx={ctx} />;
}

const kindOf = (selection) => {
  const el = Array.isArray(selection) ? selection[0] : selection;
  return el?.attrs?.['data-dc-kind'] || 'digital';
};

export const ARTBOARD_WEB_SLOTS = Object.freeze([
  [
    'size',
    {
      id: 'size.artboard-web',
      order: 10,
      kinds: ['artboard'],
      title: 'Artboard',
      when: ({ selection }) => kindOf(selection) === 'web',
      Body: WebRows,
    },
  ],
  [
    'fill',
    {
      id: 'fill.artboard-web-widths',
      order: 20,
      kinds: ['artboard'],
      headless: true,
      when: ({ selection }) => kindOf(selection) === 'web',
      Body: WebWidthsRow,
    },
  ],
]);

/** @returns {() => void} take the Web page rows back out of the registry */
export function registerArtboardWebSlots() {
  const offs = ARTBOARD_WEB_SLOTS.map(([section, entry]) => registerSlot(section, entry));
  return () => {
    for (const off of offs) off();
  };
}

export const offArtboardWeb = registerArtboardWebSlots();
