// client/v2/inspector/kinds/frame.jsx — S2.11: what a Frame adds to Position and Layout (14 Editing,
// ed-lay-auto · ed-lay-reorder · ed-lay-free).
//
//   Position › Place freely     an object that sits in an auto layout can take its X and Y for itself
//                               (`object.place-freely`); inside a row or column ← → move it earlier / later
//   Advanced › Convert layout to absolute   (`layout.convert-to-absolute`; V2-8.5 c3 — 14 draws it in the folded
//                               Advanced at the inspector's foot, above the CSS the frame writes, never inline under
//                               Layout): every child keeps where it is now and the frame stops arranging them
//
// Both buttons run the registry action — the same function ⌘K and the canvas run — through the menu runner, so
// the inspector owns no write of its own here. The bodies register themselves (append-only, sections/index.js).

import { ArrowLeftRight, Move } from 'lucide-react';
import { Toggle } from '../../../inspector-controls.jsx';
import { menuRunner } from '../../shell/menu-runner.js';
import { registerAdvancedRow } from '../advanced-rows.js';
import { registerSlot } from '../slots.js';
import { Quiet, Row, effectiveCss } from '../sections/row.jsx';

const PLACED = new Set(['absolute', 'fixed']);
const FLEXY = /^(inline-)?(flex|grid)$/;

/** Does this object sit in a layout its frame runs (and so can be placed freely)? */
export const sitsInLayout = (el, read) =>
  !PLACED.has((read?.position || '').trim()) && FLEXY.test(el?.parentDisplay || '');

/** Is it a frame with children laid out by flex / grid (what Convert acts on)? */
export const isArranging = (el, read) =>
  FLEXY.test((read?.display || '').trim()) && (el?.childCount ?? 1) > 0;

function PlaceFreelyBody({ el, ctx }) {
  const read = effectiveCss(el, el?.authored || {});
  const placeable = sitsInLayout(el, read);
  if (!placeable) return null;
  const parentRow = /^(inline-)?flex$/.test(el?.parentDisplay || '');
  return (
    <>
      <Row k="Place freely" name="place-freely">
        {/* 14 ed-obj-enter: a switch, off while the frame lays it out; turning it on makes X and Y its own */}
        <span
          data-testid="insp-place-freely"
          title="Make X and Y yours: it keeps where it is and the frame stops arranging it"
        >
          <Toggle
            checked={false}
            ariaLabel="Place freely"
            onChange={(on) => {
              if (on && ctx?.editable !== false) menuRunner.run('object.place-freely');
            }}
          />
        </span>
      </Row>
      {parentRow ? (
        <Quiet testid="insp-reorder-note" line>
          <ArrowLeftRight size={11} /> In auto layout, ← → move it earlier or later.
        </Quiet>
      ) : null}
    </>
  );
}

function ConvertBody({ el, ctx }) {
  const read = effectiveCss(el, el?.authored || {});
  if (!isArranging(el, read)) return null;
  return (
    <>
      <button
        type="button"
        className="btn btn--sm"
        data-testid="insp-layout-convert"
        disabled={ctx?.editable === false || ctx?.canEdit === false}
        onClick={() =>
          (ctx?.runAction ?? ((id) => menuRunner.run(id)))('layout.convert-to-absolute')
        }
      >
        <Move size={12} /> Convert layout to absolute
      </button>
      <Quiet testid="insp-layout-convert-note">
        Each card keeps where it is now; the frame stops arranging them. ⌘Z brings the layout back.
      </Quiet>
    </>
  );
}

let offs = [];

/** Register both bodies (idempotent: the module does it once on import; tests that unregistered call it again). */
export function registerFrameSlots() {
  if (offs.length) return;
  offs = [
    registerSlot('position', {
      id: 'position.place-freely',
      order: 90,
      kinds: ['frame', 'button', 'text', 'image', 'instance'],
      Body: PlaceFreelyBody,
    }),
    registerAdvancedRow('css', {
      id: 'css.convert-to-absolute',
      order: 5,
      kinds: ['element'],
      when: ({ ctx }) => ctx?.canEdit !== false,
      Body: ConvertBody,
    }),
  ];
}

function unregisterFrameSlots() {
  for (const off of offs) off();
  offs = [];
}

registerFrameSlots();

export const offPlaceFreely = unregisterFrameSlots;
export const offConvert = () => {};
