// client/v2/inspector/sections/fill.jsx — S2.4: Fill (14 Editing, ed-inspector §4).
// "Colour from the Design system first; + adds another fill — a colour, a gradient or an image."
//
// The colour is a token chip with its opacity; gradients and images are layers over it. Several objects that differ show
// their swatches and "Mixed"; a pick goes to all of them. Writes go through the words → CSS writer (words-paint.ts).

import { X } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import {
  fillFromCss,
  fillToCss,
  imageUrlOk,
  paintFromCss,
  paintToCss,
  reduceMixed,
} from '../../../../edit-ops/words-paint.ts';
import { fillSlotFor, slotCss, slotPaint } from '../../../../edit-ops/slot-defaults.ts';
import { useCssWrite } from '../css-write.js';
import { BOXY_KINDS } from './size.jsx';
import { targetOf } from '../kinds/multi.jsx';
import { registerSlot } from '../slots.js';
import { useDsFamilies } from '../token-chip.jsx';
import { ColorControl } from './color-control.jsx';
import { useRecentColours } from './recent-colours.js';
import { Quiet, Row } from './row.jsx';

/* The "+" in the header opens the add row for the selected element; one at a time, forgotten on a new selection. */
let adding = null;
const subs = new Set();
const setAdding = (v) => {
  adding = v;
  for (const f of subs) f();
};
const subscribe = (f) => {
  subs.add(f);
  return () => subs.delete(f);
};
const keyOf = (el) => `${el?.id ?? ''}#${el?.index ?? 0}`;

function Layer({ layer, index, onRemove, disabled }) {
  const image = layer.kind === 'image';
  return (
    <Row k={image ? 'Image' : 'Gradient'} name={`fill-layer-${index}`}>
      <span className="insp-layer">
        <i
          className="insp-sw insp-sw--wide"
          aria-hidden="true"
          style={image ? { backgroundImage: `url("${layer.url}")` } : { background: layer.css }}
        />
        <span className="insp-quiet-inline">{image ? layer.url.split('/').pop() : 'Linear'}</span>
        <button
          type="button"
          className="insp-x"
          data-testid={`insp-fill-remove-${index}`}
          aria-label={`Remove ${image ? 'image' : 'gradient'}`}
          title={`Remove ${image ? 'image' : 'gradient'}`}
          disabled={disabled}
          onClick={onRemove}
        >
          <X size={12} />
        </button>
      </span>
    </Row>
  );
}

export function FillBody({ el, selection, kind, ctx }) {
  const { cssAll, editable, write, live } = useCssWrite(targetOf({ el, selection, kind }), ctx);
  const fam = useDsFamilies(ctx);
  const open = useSyncExternalStore(subscribe, () => adding) === keyOf(el);
  const [url, setUrl] = useState('');
  const [bad, setBad] = useState(false);

  const fills = cssAll.map(fillFromCss);
  const red = reduceMixed(fills);
  const fill = red.mixed ? null : red.value;
  const set = (next) => editable && write(fillToCss(next));

  // P6 T3 (IR-11, TD3): "+" starts from the slot's role token with a literal fallback — a shape's Fill is `--bg-3`,
  // a box's Background `--bg-1`, a gradient runs to `--bg-0` — never `currentColor` (which painted in the panel's own
  // grey and read as code). With no system, the last colour used in this project comes first.
  const slot = fillSlotFor(kind);
  const recent = useRecentColours(ctx);
  const startPaint = () =>
    !fam.hasSystem && recent[0] ? paintFromCss(recent[0]) : slotPaint(slot);
  const base = fill ?? { color: null, layers: [] };

  const addColour = () => {
    setAdding(null);
    set({ ...base, color: base.color ?? { paint: startPaint(), opacity: 100 } });
  };
  const addGradient = () => {
    setAdding(null);
    const a = base.color ? paintToCss(base.color.paint) : slotCss(slot);
    const b = slotCss('gradientEnd');
    set({
      ...base,
      layers: [{ kind: 'gradient', css: `linear-gradient(180deg, ${a}, ${b})` }, ...base.layers],
    });
  };
  const addImage = () => {
    const u = url.trim();
    if (!imageUrlOk(u)) return setBad(true);
    setBad(false);
    setUrl('');
    setAdding(null);
    set({ ...base, layers: [{ kind: 'image', url: u }, ...base.layers] });
  };

  return (
    <>
      <Row k="Fill" name="fill" dim={!red.mixed && !fill?.color && !fill?.layers.length}>
        <ColorControl
          name="fill"
          label="Fill"
          ctx={ctx}
          resolved={el?.computed?.color}
          inheritedWord="Text colour"
          value={fill?.color ?? null}
          mixed={red.mixed ? red.values.map((f) => f.color) : null}
          colors={fam.color}
          vals={fam.vals}
          themes={fam.themes}
          slotGroup="surfaces"
          allowNone
          showOpacity
          opacityLive={
            fill?.color
              ? live((n) => fillToCss({ ...base, color: { ...fill.color, opacity: n } }))
              : undefined
          }
          disabled={!editable}
          onChange={(color) => set({ ...base, color })}
        />
      </Row>
      {fill
        ? fill.layers.map((layer, i) => (
            <Layer
              // biome-ignore lint/suspicious/noArrayIndexKey: layers are positional (top first)
              key={i}
              layer={layer}
              index={i}
              disabled={!editable}
              onRemove={() => set({ ...base, layers: base.layers.filter((_, j) => j !== i) })}
            />
          ))
        : null}
      {open ? (
        <div className="insp-addrow" data-testid="insp-fill-add">
          <button
            type="button"
            className="insp-chip"
            data-testid="insp-fill-add-colour"
            onClick={addColour}
            disabled={!editable || !!base.color}
            title={base.color ? 'There is a colour already; change it above.' : undefined}
          >
            Colour
          </button>
          <button
            type="button"
            className="insp-chip"
            data-testid="insp-fill-add-gradient"
            onClick={addGradient}
          >
            Gradient
          </button>
          <span className="insp-num">
            <input
              className="insp-num-in insp-url-in"
              type="text"
              aria-label="Image — a file in the project or an https:// address"
              aria-invalid={bad || undefined}
              data-testid="insp-fill-add-image"
              placeholder="Image…"
              value={url}
              onChange={(e) => setUrl(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addImage();
                else if (e.key === 'Escape') setAdding(null);
              }}
            />
          </span>
          {bad ? (
            <Quiet testid="insp-fill-image-error">
              Use a file in the project or an https:// address.
            </Quiet>
          ) : null}
        </div>
      ) : null}
      {!editable ? (
        <Quiet testid="insp-fill-locked">
          This object has no id yet. Edit element id… gives it one.
        </Quiet>
      ) : null}
    </>
  );
}

export const FILL_KINDS = [...BOXY_KINDS, 'multi'];

export const offFill = registerSlot('fill', {
  id: 'fill.words',
  order: 10,
  kinds: FILL_KINDS,
  Body: FillBody,
  add: ({ el }) => setAdding(adding === keyOf(el) ? null : keyOf(el)),
});
