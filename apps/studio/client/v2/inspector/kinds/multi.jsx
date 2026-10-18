// client/v2/inspector/kinds/multi.jsx — S2.4: several objects at once (14 Editing, ed-obj-multi).
//
//   "The inspector shows what they share and says Mixed where they differ."
//   · a row shows the shared value, or "Mixed" (swatches for colours) — `reduceMixed` in edit-ops/words-paint.ts;
//   · one edit goes to every selected object (`useCssWrite` takes the whole selection) — the line says so;
//   · text settings show only when every object is text.
//
// This file owns the helpers every section uses to ask "what am I editing?" and the two things only the Mixed inspector
// draws: the Opacity row (under Fill — for one object it sits under Effects) and the line at the foot.

import { registerSlot } from '../slots.js';
import { Quiet } from '../sections/row.jsx';
import { OpacityRow } from '../sections/opacity-row.jsx';
import { useCssWrite } from '../css-write.js';
import { resolveKind } from './index.js';

/** What a section edits: the whole selection when it is several objects, else the one element. */
export const targetOf = ({ el, selection, kind }) =>
  kind === 'multi' && Array.isArray(selection) ? selection : el;

/** Every selected object is text (a one-element array counts). */
export function isAllText(selection) {
  const list = Array.isArray(selection) ? selection : selection ? [selection] : [];
  return list.length > 0 && list.every((e) => resolveKind(e).id === 'text');
}

function MultiOpacity({ el, selection, kind, ctx }) {
  const { cssAll, editable, write, count } = useCssWrite(targetOf({ el, selection, kind }), ctx);
  return (
    <>
      <OpacityRow cssAll={cssAll} editable={editable} write={write} />
      <Quiet testid="insp-multi-note">
        {`Changes go to all ${count}. Text settings show when only text is selected.`}
      </Quiet>
    </>
  );
}

export const offMulti = registerSlot('fill', {
  id: 'fill.multi',
  order: 90,
  kinds: ['multi'],
  Body: MultiOpacity,
});
