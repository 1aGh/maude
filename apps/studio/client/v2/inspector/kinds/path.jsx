// client/v2/inspector/kinds/path.jsx — S2.14: a Pen path in the inspector (14 Editing, ed-pen).
//
//   Kind chip   "Pen · 4 points" — an object carrying `data-shape="path"` (what the Pen writes, and what Combine
//               makes). The count is read from the live `d` by the canvas (`data-dc-pen-points`, never stored).
//   Stroke      the Border section called Stroke (border.jsx): a colour token and a width, written as `stroke` /
//               `stroke-width` on the path's svg; this file adds its Ends row — Round or Flat.
//   Combine shapes  Union · Subtract · Intersect · Exclude (S2-slices Q6): "Two or more" — greyed for one object,
//               live when several shapes are selected. One click is ONE `shape.combine.<kind>` edit-op asked of the
//               canvas through `run-action`; the result is one `<svg>` that exports identically.
//
// The bodies register themselves (append-only, sections/index.js).

import { PointBody } from '../sections/point.jsx';
import { pointOf } from '../path-point.js';
import { Row } from '../sections/row.jsx';
import { registerSlot } from '../slots.js';
import { useCssWrite } from '../css-write.js';
import { Segmented } from '../../../inspector-controls.jsx';
import { registerKind, singleOf } from './index.js';

/** "Pen · 4 points" — the chip; "Path" until the canvas has counted. */
export function penChipOf(el) {
  const n = Number.parseInt(el?.attrs?.['data-dc-pen-points'] ?? '', 10);
  if (!Number.isFinite(n) || n < 1) return 'Path';
  return `Pen · ${n} ${n === 1 ? 'point' : 'points'}`;
}

const isPath = (s) => {
  const el = singleOf(s);
  return !!el && !Array.isArray(el) && el.attrs?.['data-shape'] === 'path';
};

const ENDS = [
  { value: 'round', label: 'Round' },
  { value: 'butt', label: 'Flat' },
];

function PathEndsBody({ el, ctx }) {
  const { css, editable, write } = useCssWrite(el, ctx);
  // Ends only mean something once there is a stroke to end
  if (!css.stroke || /^none$/i.test(css.stroke.trim())) return null;
  const cap = css['stroke-linecap'] === 'butt' ? 'butt' : 'round';
  return (
    <Row k="Ends" name="path-ends">
      <span data-testid="insp-ctl-path-ends">
        <Segmented
          value={cap}
          ariaLabel="Stroke ends"
          options={ENDS}
          onChange={(v) => editable && v !== cap && write({ 'stroke-linecap': v })}
        />
      </span>
    </Row>
  );
}

/** 14 Editing's own glyphs (`LG.union` …): 16-unit boxes, 1.5 stroke, drawn by the row — the shell icon set has none. */
const COMBINE_GLYPHS = {
  union: <path d="M2.5 2.5h7v4h4v7h-7v-4h-4z" />,
  subtract: (
    <>
      <path d="M2.5 2.5h7v4h-3v3h-4z" />
      <path d="M6.5 6.5h7v7h-7z" strokeDasharray="1.5 1.5" />
    </>
  ),
  intersect: (
    <>
      <path d="M2.5 2.5h7v7h-7zM6.5 6.5h7v7h-7z" strokeDasharray="1.5 1.5" />
      <path d="M6.5 6.5h3v3h-3z" />
    </>
  ),
  exclude: <path d="M2.5 2.5h7v4h-3v3h-4zM9.5 6.5h4v7h-7v-4h3z" />,
};

export const COMBINE_ROWS = [
  { kind: 'union', label: 'Union' },
  { kind: 'subtract', label: 'Subtract' },
  { kind: 'intersect', label: 'Intersect' },
  { kind: 'exclude', label: 'Exclude' },
];

/** Several shapes selected: every one a Shape or Path (an `svg`/`div` carrying `data-shape`), none a line. */
export function combinable(selection) {
  const list = Array.isArray(selection) ? selection : selection ? [selection] : [];
  return (
    list.length >= 2 &&
    list.every((e) => {
      const s = e?.attrs?.['data-shape'];
      return typeof s === 'string' && s !== 'line';
    })
  );
}

function CombineBody({ selection, ctx }) {
  const live = combinable(selection) && ctx?.editable !== false && !!ctx?.onRunAction;
  return (
    <Row k="Two or more" name="combine" dim={!live}>
      <span
        className="seg insp-combine"
        data-testid="insp-combine"
        role="group"
        aria-label="Combine shapes"
      >
        {COMBINE_ROWS.map((r) => (
          <button
            key={r.kind}
            type="button"
            className="k-seg-b insp-combine-btn"
            data-testid={`insp-combine-${r.kind}`}
            aria-label={r.label}
            title={r.label}
            disabled={!live}
            onClick={() =>
              live && ctx.onRunAction({ dgn: 'run-action', v: 1, id: `shape.combine.${r.kind}` })
            }
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {COMBINE_GLYPHS[r.kind]}
            </svg>
          </button>
        ))}
      </span>
    </Row>
  );
}

let offs = [];

/** Register the kind, Ends and Combine (idempotent; tests that unregistered call it again). */
export function registerPathKind() {
  if (offs.length) return;
  offs = [
    registerKind({ id: 'path', label: (s) => penChipOf(singleOf(s)), order: 24, match: isPath }),
    registerSlot('border', {
      id: 'border.path-ends',
      order: 20,
      kinds: ['path'],
      Body: PathEndsBody,
    }),
    registerSlot('point', {
      id: 'point.words',
      order: 10,
      kinds: ['path'],
      // only while the canvas says a point of this path is selected (point editing)
      when: ({ selection }) => !!pointOf(Array.isArray(selection) ? null : selection),
      Body: PointBody,
    }),
    registerSlot('combine', {
      id: 'combine.words',
      order: 10,
      // one shape greys the row ("Two or more"); several show it live; text, frames and images never show it
      kinds: ['path', 'shape', 'multi'],
      Body: CombineBody,
    }),
  ];
}

export const offPath = () => {
  for (const off of offs) off();
  offs = [];
};

registerPathKind();
