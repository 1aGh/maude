// client/v2/inspector/kinds/shape.jsx — S2.13: a drawn shape in the inspector (14 Editing, ed-shape).
//
//   Kind chip  "Shape" — an object carrying `data-shape` (what the Shape tools write: rectangle · ellipse · line ·
//              polygon). A Frame has none and stays "Frame".
//   Size ›     a "Kind" row ahead of W · H says which one it is. Corners, Fill, Border (+) with Position and
//              Effects are the sections every box already has (S2.4); they apply to a shape unchanged.
//
// The kind is read from the file's own attribute, so a shape an agent wrote by hand reads the same.
// The bodies register themselves (append-only, sections/index.js).

import { Row } from '../sections/row.jsx';
import { registerSlot } from '../slots.js';
import { registerKind, singleOf } from './index.js';

export const SHAPE_KIND_NAMES = Object.freeze({
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  polygon: 'Polygon',
});

/** The word for a shape's `data-shape` ("Rectangle"), or "Shape" for a value this build does not know. */
export const shapeKindName = (value) => SHAPE_KIND_NAMES[value] ?? 'Shape';

const isShape = (s) => {
  const el = singleOf(s);
  return !!el && !Array.isArray(el) && typeof el.attrs?.['data-shape'] === 'string';
};

function ShapeKindBody({ el }) {
  return (
    <Row k="Kind" name="shape-kind">
      <span data-testid="insp-shape-kind">{shapeKindName(el?.attrs?.['data-shape'])}</span>
    </Row>
  );
}

let offs = [];

/** Register the kind and the Kind row (idempotent; tests that unregistered call it again). */
export function registerShapeKind() {
  if (offs.length) return;
  offs = [
    registerKind({ id: 'shape', label: 'Shape', order: 25, match: isShape }),
    registerSlot('size', {
      id: 'size.shape-kind',
      order: 5,
      kinds: ['shape'],
      Body: ShapeKindBody,
    }),
  ];
}

export const offShape = () => {
  for (const off of offs) off();
  offs = [];
};

registerShapeKind();
