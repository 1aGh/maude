// client/v2/inspector/sections/effects.jsx — S2.4: Effects (14 Editing, ed-inspector §7).
// "Shadows are the system's elevation — Flat, Resting, Floating, Sheet — the lowered, soft kind."
//
// The Shadow segment is built from the design system's own `--shadow-*` tokens, in the order it declares them, after
// Flat: another system gets its own names (sm · md · lg, Soft · Lifted …), never this list. A shadow the system does not
// name reads as Custom until another is picked. Opacity sits beside it.

import {
  elevationFromCss,
  elevationOptions,
  elevationToCss,
} from '../../../../edit-ops/words-paint.ts';
import { Segmented, Select } from '../../../inspector-controls.jsx';
import { useCssWrite } from '../css-write.js';
import { registerSlot } from '../slots.js';
import { useDsFamilies } from '../token-chip.jsx';
import { requestAdd, useAddRequest } from './add-requests.js';
import { OpacityRow } from './opacity-row.jsx';
import { Quiet, Row } from './row.jsx';
import { BOXY_KINDS } from './size.jsx';

const levelOf = (e) => (e === 'flat' ? 'flat' : 'token' in e ? e.token : 'custom');

export function EffectsBody({ el, ctx }) {
  const { css, cssAll, editable, write } = useCssWrite(el, ctx);
  const fam = useDsFamilies(ctx);
  const elevation = elevationFromCss(css);
  const options = elevationOptions(fam.shadow);
  const current = levelOf(elevation);
  const named = current === 'flat' || fam.shadow.includes(current);
  const shown = named ? options : [...options, { value: 'custom', label: 'Custom' }];
  const face = named ? current : 'custom';
  const pick = (v) => {
    if (!editable || v === 'custom' || v === current) return;
    write(elevationToCss(v === 'flat' ? 'flat' : { token: v }, css['box-shadow']));
  };
  // the "+": the system's first (lowest) step, when there is none yet
  useAddRequest('effects', el, () => {
    if (current === 'flat' && fam.shadow[0]) pick(fam.shadow[0]);
  });

  return (
    <>
      <Row k="Shadow" name="shadow">
        <span data-testid="insp-ctl-shadow">
          {shown.length <= 5 ? (
            <Segmented value={face} ariaLabel="Shadow" options={shown} onChange={pick} />
          ) : (
            <Select value={face} ariaLabel="Shadow" options={shown} onChange={pick} mini />
          )}
        </span>
      </Row>
      {fam.shadow.length === 0 ? (
        <Quiet testid="insp-shadow-none">This system has no shadow steps.</Quiet>
      ) : null}
      <OpacityRow cssAll={cssAll} editable={editable} write={write} />
    </>
  );
}

export const offEffects = registerSlot('effects', {
  id: 'effects.words',
  order: 10,
  kinds: BOXY_KINDS,
  Body: EffectsBody,
  add: ({ el }) => requestAdd('effects', el),
});
