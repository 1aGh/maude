// client/v2/inspector/sections/fill.jsx — S2.4: Fill (14 Editing, ed-inspector §4).
// "Colour from the Design system first; + adds another fill — a colour, a gradient or an image." Since r6 the "+" opens
// the picker, whose Solid · Gradient · Image tabs are that choice (Michal: three buttons under the row repeated it).
//
// The colour is a token chip with its opacity; gradients and images are layers over it. Several objects that differ show
// their swatches and "Mixed"; a pick goes to all of them. Writes go through the words → CSS writer (words-paint.ts).

import { X } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  fillFromCss,
  fillToCss,
  paintFromCss,
  reduceMixed,
} from '../../../../edit-ops/words-paint.ts';
import {
  fillSlotFor,
  NEUTRAL_MID_GREY,
  slotCss,
  slotPaint,
} from '../../../../edit-ops/slot-defaults.ts';
import { useCssWrite } from '../css-write.js';
import { BOXY_KINDS } from './size.jsx';
import { targetOf } from '../kinds/multi.jsx';
import { registerSlot } from '../slots.js';
import { useDsFamilies } from '../token-chip.jsx';
import { ColorControl } from './color-control.jsx';
import { GRADIENT_WORDS, parseGradient } from './colour-model.js';
import { useRecentColours } from './recent-colours.js';
import { Quiet, Row } from './row.jsx';

/* The "+" in the header opens the picker for the selected element; one at a time, forgotten on a new selection. */
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
  const [openSignal, setOpenSignal] = useState(0);

  const fills = cssAll.map(fillFromCss);
  const red = reduceMixed(fills);
  const fill = red.mixed ? null : red.value;
  const set = (next) => editable && write(fillToCss(next));

  // P6 T3 (IR-11, TD3): "+" starts from the slot's role token with a literal fallback — a shape's Fill is `--bg-3`,
  // a box's Background `--bg-1`, a gradient runs to `--bg-0` — never `currentColor` (which painted in the panel's own
  // grey and read as code). With no system, the last colour used in this project comes first, else a neutral mid grey.
  const slot = fillSlotFor(kind);
  const recent = useRecentColours(ctx);
  const startPaint = () =>
    fam.hasSystem
      ? slotPaint(slot)
      : recent[0]
        ? paintFromCss(recent[0])
        : { css: NEUTRAL_MID_GREY }; // IR-11: no system, nothing in Recent — a neutral mid grey, not a role token
  const base = fill ?? { color: null, layers: [] };

  // r4 #4: the colour popover's Solid · Gradient · Image tabs say what the fill IS and write the whole fill. A drag is
  // previewed on the canvas through the same lane the opacity scrub uses (`live`); the release commits once.
  const preview = live((patch) => patch);
  const fillApi = editable
    ? {
        fill: base,
        set,
        live: (next) => preview.onInput(fillToCss(next)),
        start: slotCss(slot),
        end: slotCss('gradientEnd'),
      }
    : null;
  // a gradient or a picture with no colour under it: the chip says so, not "None"
  const top = !red.mixed && fill && !fill.color ? fill.layers[0] : null;
  const face = top
    ? top.kind === 'gradient'
      ? {
          swatch: top.css,
          word: `${GRADIENT_WORDS[parseGradient(top.css)?.type] ?? 'Linear'} gradient`,
        }
      : { swatch: 'var(--bg-4)', word: top.url.split('/').pop() }
    : null;

  // "+": an empty fill first gets the slot's role colour (IR-11), then the picker opens on it — a gradient or a picture is
  // a tab there, not a second row of buttons
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per "+", with this render's fill
  useEffect(() => {
    if (!open) return;
    setAdding(null);
    if (editable && !base.color && !base.layers.length)
      set({ ...base, color: { paint: startPaint(), opacity: 100 } });
    setOpenSignal((n) => n + 1);
  }, [open]);

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
          fillApi={fillApi}
          face={face}
          openSignal={openSignal}
          onChange={(color, o) =>
            set(
              color === null
                ? { color: null, layers: [] } // None: no fill at all
                : o?.replaceLayers
                  ? { color, layers: [] } // a colour picked while the Image tab was open
                  : { ...base, color }
            )
          }
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
