// client/v2/inspector/sections/corners.jsx — S2.4: Corners (14 Editing, ed-inspector §5 and ed-shape).
// "One home on every object: one value, or unlink for each corner. Round, XS … XL from the system."
//
// One length chip for all four corners, or — unlinked — ↖ ↗ ↙ ↘ each with its own. The names are the system's own
// radius tokens (`--radius-*`, read from its tokens CSS); a plain number shows plainly with Bind. Writes `border-radius`
// (one value, or four in CSS order) through the words → CSS writer.

import { Unlink } from 'lucide-react';
import { useMemo, useSyncExternalStore } from 'react';
import {
  cornersFromCss,
  cornersLinked,
  cornersToCss,
  cornerToCss,
  reduceMixed,
  systemName,
} from '../../../../edit-ops/words-paint.ts';
import { useCssWrite } from '../css-write.js';
import { targetOf } from '../kinds/multi.jsx';
import { registerSlot } from '../slots.js';
import { LengthControl, useDsFamilies } from '../token-chip.jsx';
import { Quiet, Row } from './row.jsx';
import { BOXY_KINDS } from './size.jsx';

/* The person's choice per element: 'linked' | 'unlinked'. Absent = what the corners say (equal → linked). */
const choice = new Map();
const subs = new Set();
const subscribe = (f) => {
  subs.add(f);
  return () => subs.delete(f);
};
let version = 0;
const keyOf = (el) => `${el?.id ?? ''}#${el?.index ?? 0}`;
const modeOf = (el, words) =>
  choice.get(keyOf(el)) ?? (cornersLinked(words) ? 'linked' : 'unlinked');

/** Tests only: forget which elements the person linked or unlinked. */
export function forgetCornerChoices() {
  choice.clear();
}

const radiusLabel = (token) => systemName(token, 'radius');
const ARROWS = [
  ['tl', '↖', 'Top left'],
  ['tr', '↗', 'Top right'],
  ['bl', '↙', 'Bottom left'],
  ['br', '↘', 'Bottom right'],
];

/** The header's unlink toggle (an `aside` of the slot: a component, so it can read the store). */
function UnlinkToggle({ el }) {
  useSyncExternalStore(subscribe, () => version);
  const words = cornersFromCss(el?.authored || {});
  const unlinked = modeOf(el, words) === 'unlinked';
  return (
    <button
      type="button"
      className="insp-sec-ic"
      data-testid="insp-corners-unlink"
      data-on={unlinked ? 'true' : undefined}
      aria-pressed={unlinked}
      aria-label={unlinked ? 'Link the corners' : 'Unlink the corners'}
      title={unlinked ? 'Link the corners' : 'Unlink — set each corner'}
      onClick={() => {
        choice.set(keyOf(el), unlinked ? 'linked' : 'unlinked');
        version += 1;
        for (const f of subs) f();
      }}
    >
      <Unlink size={12} />
    </button>
  );
}

export function CornersBody({ el, selection, kind, ctx }) {
  const { cssAll, count, editable, write } = useCssWrite(targetOf({ el, selection, kind }), ctx);
  const fam = useDsFamilies(ctx);
  useSyncExternalStore(subscribe, () => version);
  const tokens = useMemo(() => ({ space: fam.radius }), [fam.radius]);

  const all = cssAll.map((c) => cornersFromCss(c, tokens));
  const red = reduceMixed(all);
  const words = red.mixed ? all[0] : red.value;
  const mode = modeOf(el, words);
  const set = (next) => editable && write(cornersToCss(next));
  const setAll = (len) => {
    const l = len ?? { px: 0 };
    set({ tl: l, tr: l, br: l, bl: l });
  };

  if (mode === 'linked') {
    const unevenAcross = red.mixed || !cornersLinked(words);
    return (
      <>
        <Row k="All" name="corners">
          <LengthControl
            name="corners"
            label="Corners"
            value={unevenAcross ? null : words.tl}
            tokens={tokens}
            labelOf={radiusLabel}
            allowNone
            noneLabel={unevenAcross ? 'Mixed' : 'None'}
            disabled={!editable}
            onChange={setAll}
          />
        </Row>
        {words.exotic ? (
          <Quiet testid="insp-corners-exotic">{`Corners are set as ${words.exotic}. Pick a value to replace it.`}</Quiet>
        ) : null}
      </>
    );
  }
  return (
    <div className="insp-corners" data-testid="insp-corners">
      {ARROWS.map(([k, arrow, name]) => {
        const values = all.map((w) => w[k]);
        const r = reduceMixed(values);
        return (
          <span className="insp-corner" key={k} data-testid={`insp-row-corner-${k}`}>
            <span className="insp-ax" aria-hidden="true">
              {arrow}
            </span>
            <LengthControl
              name={`corner-${k}`}
              label={`${name} corner`}
              value={r.mixed ? null : r.value}
              tokens={tokens}
              labelOf={radiusLabel}
              allowNone
              noneLabel={r.mixed ? 'Mixed' : 'None'}
              disabled={!editable}
              onChange={(len) =>
                editable &&
                // several objects whose corners differ: this corner only, the others stay as they are
                (count > 1 && red.mixed
                  ? write(cornerToCss(k, len ?? { px: 0 }))
                  : set({ ...words, [k]: len ?? { px: 0 } }))
              }
            />
          </span>
        );
      })}
    </div>
  );
}

/** Everything with a box except a Pen path (it has no corners to round). */
export const CORNER_KINDS = BOXY_KINDS.filter((k) => k !== 'path');

export const offCorners = registerSlot('corners', {
  id: 'corners.words',
  order: 10,
  kinds: CORNER_KINDS,
  Body: CornersBody,
  aside: ({ el }) => <UnlinkToggle el={el} />,
});
